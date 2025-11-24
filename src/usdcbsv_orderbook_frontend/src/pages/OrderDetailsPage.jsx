import React from 'react';
import { useParams } from 'react-router-dom';
import OrderDetails from '../components/maker/OrderDetails';

const OrderDetailsPage = () => {
  const { orderId } = useParams();
  
  return (
    <div className="container mx-auto">
      <OrderDetails 
        orderId={parseInt(orderId)} 
      />
    </div>
  );
};

export default OrderDetailsPage;
